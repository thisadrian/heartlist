'use strict'

const {ipcRenderer, shell} = require('electron')
const {globalShortcut} = require('electron').remote
const jetpack = require("fs-jetpack");
const Spotify = require('spotify-web-api-node');
const S = new Spotify({redirectUri: 'heartlist://'});

let user = localStorage.getItem('user'),
    state = "",
    secrets = {},
    scopes = ['user-read-currently-playing', 'user-read-playback-state', 'playlist-read-private', 'playlist-modify-private', 'playlist-read-collaborative', 'playlist-modify-public'];

let playlistName,
    playlist = null,
    track = null;

let gettingTrack = false,
    addingTrack = false;

let trackTimeout;

// DOM
const container = document.getElementsByTagName('main')[0]
const addTrackTrigger = document.getElementById('add-track')
const heart = document.getElementById('heart-container')
const trackName = document.getElementById('track-name')
const trackArtist = document.getElementById('track-artist')
const trackImage = document.getElementById('track-image')
const errText = document.getElementById('error');

// Init
init()

// Sets client secret & ID
// Checks if we have access or begin process
function init() {
  if (localStorage.getItem('accessToken') === null) {
    ipcRenderer.send('request-auth')
  } else {
    getSettings();
  }
}

ipcRenderer.on('done-with-settings', (event, data) => {
  getSettings();
})

function getSettings() {
  user = localStorage.getItem('user');
  playlistName = localStorage.getItem('playlistName');
  playlist = JSON.parse(localStorage.getItem('playlist'));
  setAccess({access: localStorage.getItem('accessToken'), refresh: localStorage.getItem('refresh')})
}

// Set access & refresh tokens.
function setAccess(data) {
  if (typeof data.access === 'string') {
    S.setAccessToken(data.access);
    // Save time set
    localStorage.setItem('access', Date.now())
  }
  if (typeof data.refresh === 'string') {
    // Set and save
    S.setRefreshToken(data.refesh);
    localStorage.setItem('refreshToken', data.refresh);
  }

  // On initial setup, set user, which will then set playlist
  if (playlist === null) getPlaylist();

  // If getting a track was interrupted and we needed
  // to refresh access.
  if (gettingTrack) getTrack();
}

function refreshAccess() {
  S.setRefreshToken(localStorage.refreshToken);
  S.refreshAccessToken().then(
    function(data) {
      let params = {access: data.body['access_token']}
      // Docs said sometimes we'll get a new refresh token
      if (typeof data.body['refesh_token'] != 'undefined') {
        params['refresh'] = data.body['refesh_token']
      }
      setAccess(params)
    },
    function(err) {
      // If can't refresh, assume we lost authorization.
      requestAuth();
    }
  );
}

// Get playlist
function getPlaylist() {
  let attempts = 3;
  for (let i = 0; i < attempts; i++) {
    if (playlist !== null) {
      break;
    }
    S.getUserPlaylists(user, {limit: 50, offset: i*50}).then(
      function(data) {
        for (let item of data.body.items) {
          if (item.name === playlistName) {
            // Set playlist
            playlist = item;
            // Set the shortcut
            globalShortcut.register('CommandOrControl+Shift+K', () => {
              addTrack();
            })
            // Get updated tracks
            getUpdatedTracks();
            break;
          }
        }
      },
      function(err) {
        if (err.message === "Unauthorized")
          shell.openExternal('https://beta.developer.spotify.com/console/get-current-user-playlists/')
      }
    )
  }
}

// Get tracks from playlist
// For checking against current playing track
// to avoid adding dupes.
function getUpdatedTracks() {
  S.getPlaylistTracks(user, playlist.id).then(
    function(data) {
      playlist.tracks = [];
      for (var v of data.body.items) {
        playlist.tracks.push(v.track.id)
      }
    },
    function(err) {
      console.error('getPlaylistTracks', err)
    }
  )
}

function noTrackFound() {
  errText.textContent = "No song found. "
}

function clearUI() {
  trackArtist.textContent = '';
  trackName.textContent = ''
  trackImage.src = ''
  container.classList.add('loading')
  errText.textContent = ''
}

function updateHeartStatusInUI(track) {
  let artists = []
  for (var v of track.artists) {
    artists.push(v.name)
  }
  errText.textContent = ''
  container.classList.remove('loading')
  trackArtist.textContent = artists.join(', ')
  trackName.textContent = track.name
  trackImage.src = track.album.images[0].url
  console.log(playlist)
  if (playlist.tracks.items.indexOf(track.id) > -1) {
    heart.classList.add('liked')
  } else {
    heart.classList.remove('liked')
  }

}

// Get track when window is opened.
// Called from main process when window toggled
ipcRenderer.on('window-toggled', (event, data) => {
  if (data === 'open') {
    getTrack();
  }
})

// Get current playing track, then display
function getTrack() {
  clearUI();
  // check if need to refresh
  let time = parseInt(localStorage.getItem('access'));
  if ( (time + (60*60*1000)) < Date.now() ) {
    gettingTrack = true;
    refreshAccess();
  } else {
    S.getMyCurrentPlayingTrack(user)
    .then(
      function(data) {
        //console.log(data)
        if (Object.keys(data.body).length === 0 && data.body.constructor === Object) {
          noTrackFound();
        } else {
          gettingTrack = false;
          updateHeartStatusInUI(data.body.item)
          if (addingTrack) {
            addTrack();
          }
        }
      },
      function(err) {
        console.error('getTrack', err)
        // Try again
        gettingTrack = true;
        refreshAccess();
      }
    )
  }
}

// Add current playing track
function addTrack() {
  // Always get track before adding, to insure we heart actual current playing track.

  // addingTrack is always false at first
  if (!addingTrack) {
    // then we set it to true and get the track
    // getTrack() calls addTrack again
    // and then addingTrack is true, and all this gets skipped.
    addingTrack = true;
    getTrack()
  } else {
    let id = track.uri.split(':')[2];
    if (playlist.tracks.indexOf(id) < 0) {
      S.addTracksToPlaylist(user, playlist.id, [track.uri])
      .then(function(data) {
        addingTrack = false;
        playlist.tracks.push(id)
        updateHeartStatusInUI()
        // Send request to main process to open window
        ipcRenderer.send('open-window')
      }, function(err) {
        console.error('addTrack', err)
      });
    }
  }
}


// Dom event listeners
addTrackTrigger.addEventListener('click', () => {
  addTrack()
})
