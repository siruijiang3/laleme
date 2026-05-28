/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www.pupumap.me",
          },
        ],
        destination: "https://pupumap.me/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
