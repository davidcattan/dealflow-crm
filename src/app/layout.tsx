import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dealflow CRM",
  description: "Deal and lender matching CRM",
  // Home-screen app on iPhone: full screen, own name under the icon.
  // Solid (no transparency) icons in two sizes: iOS frames icons in white
  // when they have an alpha channel or are too small for the device.
  icons: {
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/apple-touch-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "JED",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Keeps iOS from zooming into text boxes on tap.
  maximumScale: 1,
  // Lets the bottom tab bar sit above the iPhone home indicator.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
