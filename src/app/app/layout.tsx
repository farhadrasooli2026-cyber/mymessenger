import { MusicShell } from "@/components/music-shell";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <MusicShell>{children}</MusicShell>;
}
