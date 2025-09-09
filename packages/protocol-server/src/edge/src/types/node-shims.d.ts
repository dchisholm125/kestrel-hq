// Minimal shims to allow local compile without @types/node
/* eslint-disable */
declare var process: any;
declare var console: any;

declare module 'fs' {
  export const promises: any;
  const anything: any;
  export default anything;
}

declare module 'fs/promises' {
  const anything: any;
  export = anything;
}

declare module 'node:fs' {
  export const promises: any;
}

declare module 'node:fs/promises' {
  const anything: any;
  export = anything;
}
