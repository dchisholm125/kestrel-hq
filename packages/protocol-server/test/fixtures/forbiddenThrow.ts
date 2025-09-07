export function bad() {
  // eslint should flag this in src/stages, but here we just verify rule pattern
  throw new Error('nope')
}
