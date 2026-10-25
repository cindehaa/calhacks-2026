// /pavilion on its own: just the wall, no game, camera or mic, so it can sit in a second tab (or
// on a second screen) during a demo and fill up as people play. "By you" still works, since the
// identities this browser played as are kept in localStorage (pavilion_data.ts).
import { mountPavilion, openPavilion } from './pavilion';

mountPavilion({ standalone: true });
openPavilion();
