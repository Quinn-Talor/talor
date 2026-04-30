// Tailwind v4:PostCSS 插件从主包分离到 @tailwindcss/postcss。
// v4 还内置了 autoprefixer 等价能力,但保留 autoprefixer 对历史样式兼容无害。
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
