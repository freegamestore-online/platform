/** CSS modules: each class name in a `*.module.css` file becomes a key of the default export. */
declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}
