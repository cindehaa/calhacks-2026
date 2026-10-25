// The game's own banner and heraldry, bundled for the graphics pages (scripts/render.mjs builds it).
import { tapestry } from '../../../client/src/banner';
import { EMBLEM, DAMASK } from '../../../client/src/heraldry';
(window as unknown as { Game: unknown }).Game = { tapestry, EMBLEM, DAMASK };
