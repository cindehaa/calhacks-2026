// Match clock text, for the HUD, the pause menu and the result screen.
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
