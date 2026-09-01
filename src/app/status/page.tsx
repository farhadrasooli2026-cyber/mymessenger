import { StatusBoard } from "@/components/status-board";

export default function StatusPage() {
  return (
    <main className="mx-auto max-w-lg p-6 text-amber-50">
      <h1 className="text-xl font-semibold">وضعیت نیکسو</h1>
      <p className="mt-2 text-sm text-amber-100/75">این صفحه عمومی است و جزئیات داخلی، کلید یا پشتیبان را نشان نمی‌دهد.</p>
      <StatusBoard />
    </main>
  );
}
