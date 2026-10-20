// Uses the Gamepad API without declaring it in package.json (#370).
export const pads = () => navigator.getGamepads();
