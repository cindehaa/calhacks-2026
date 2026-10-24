// Dev mode: the game opened at /dev. Only then does the camera / mic panel sit top left (the
// camera preview, hand and mic readouts, tuning settings); otherwise it's hidden and takes no
// space, and the camera button in the tools opens setup instead.
export const DEV_MODE = location.pathname.replace(/\/+$/, '') === '/dev';
document.body.classList.toggle('devMode', DEV_MODE);
