import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="card card-pad max-w-md text-center">
        <h1 className="text-lg font-bold">Committee not found</h1>
        <p className="mt-2 text-sm text-slate-500">This link is wrong, or the committee’s public page has been switched off.</p>
        <Link href="/login" className="btn btn-secondary mt-4">Admin sign in</Link>
      </div>
    </div>
  );
}
