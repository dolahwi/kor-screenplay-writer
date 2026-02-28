// @ts-expect-error next-pwa does not have type definitions
import withPWA from 'next-pwa';

const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
};

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
})(nextConfig);
