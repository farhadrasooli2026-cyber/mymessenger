import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "NIXO نیکسو — اتصال. تبادل. فراتر از مرزها.",
  description:
    "نیکسو پیام‌رسان و پلتفرم ارتباطی نسل جدید است: خصوصی، سریع، امن و قابل توسعه — نه کپی واتساپ یا تلگرام.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Toaster position="top-center" dir="rtl" />
      </body>
    </html>
  );
}
