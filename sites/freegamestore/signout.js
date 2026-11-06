// Sign-out page for games (#498): https://freegamestore.online/signout?return=<game URL>
//
// Auth refuses a game's own sign-out request (#486), so the games SDK's
// signOut() navigates here instead. This page is first-party: auth accepts its
// background POST /logout by Origin, which every browser sends on a CORS
// request. (Detecting a game's user-activated form POST relied on
// Sec-Fetch-*, which older Safari doesn't send.) The player confirms with a
// click, so a game can't sign them out just by sending them here, and no game
// can frame this page (frame-ancestors 'none').
(function () {
  'use strict';

  var HOME = 'https://freegamestore.online/';

  /** The page to return to: the game the player came from, if it is one of
   *  ours. The https rule of auth's safeRedirect, without its localhost case. */
  function safeReturn(raw) {
    try {
      var u = new URL(raw);
      var h = u.hostname;
      if (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        (h === 'freegamestore.online' || h.slice(-'.freegamestore.online'.length) === '.freegamestore.online')
      ) {
        return u.href;
      }
    } catch (e) {
      /* not an absolute URL */
    }
    return HOME;
  }

  /** POST auth's logout. It answers with a redirect that clears the session
   *  cookie, which fetch reports as an opaque redirect: that is success. */
  function signOut(fetchImpl) {
    return fetchImpl('https://auth.freegamestore.online/v1/logout', {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
    }).then(
      function (res) {
        return res.type === 'opaqueredirect' || res.ok;
      },
      function () {
        return false;
      },
    );
  }

  if (typeof module !== 'undefined') module.exports = { safeReturn: safeReturn, signOut: signOut };
  if (typeof document === 'undefined') return;

  var back = safeReturn(new URLSearchParams(location.search).get('return'));
  var button = document.getElementById('signout-confirm');
  var status = document.getElementById('signout-status');
  document.getElementById('signout-cancel').href = back;

  button.addEventListener('click', function () {
    button.disabled = true;
    status.textContent = 'Signing out…';
    signOut(fetch.bind(window)).then(function (ok) {
      if (ok) {
        location.replace(back);
        return;
      }
      button.disabled = false;
      status.textContent = 'Sign-out failed. Check your connection and try again.';
    });
  });
})();
