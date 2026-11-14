export default function NotAuthorized() {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="card card-pad max-w-md text-center">
        <h1 className="text-lg font-bold">This account is not an admin</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You are signed in, but your account has not been added to the admin list. Ask the committee owner to add you
          (see “Admin login setup” in the README), then sign in again.
        </p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button className="btn btn-secondary">Sign out</button>
        </form>
      </div>
    </div>
  );
}
