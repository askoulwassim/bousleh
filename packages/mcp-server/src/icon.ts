/*
 * The server's icon, shown by clients that draw one: the Bousleh "heavy cut" mark (the favicon
 * geometry from docs/design/home/Logo.dc.html, kept in packages/home/assets/favicon.svg).
 */

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 100 100"><title>Bousleh</title><circle cx="50" cy="50" r="50" fill="#171215"/><circle cx="50" cy="50" r="37" fill="none" stroke="#2C2227" stroke-width="11"/><circle cx="50" cy="50" r="37" fill="none" stroke="#C93A63" stroke-width="11" stroke-linecap="round" stroke-dasharray="190.6 232.5" transform="rotate(-90 50 50)"/><path d="M32,40 L32,47 Q32,55 40,55 L60,55 Q68,55 68,47 L68,31" fill="none" stroke="#F2EAED" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><polygon points="50,62 57,70 50,78 43,70" fill="#E8668C"/></svg>';

export const SERVER_ICONS = [
  { src: `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] },
];
