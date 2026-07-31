// ffprobe-static не поставляет типы, а ffmpeg-static — поставляет.
// Пакеты лежат в optionalDependencies: их может не быть вовсе,
// поэтому объявление максимально узкое.
declare module 'ffprobe-static' {
  const value: { path: string };
  export default value;
}
