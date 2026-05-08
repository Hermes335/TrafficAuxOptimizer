import { isRouteErrorResponse, Link, useRouteError } from "react-router";

export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "The app hit an unexpected error. Please try again.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = typeof error.data === "string" ? error.data : message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-3 inline-flex rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
          Application Error
        </div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{title}</h1>
        <p className="mb-6 text-sm leading-6 text-gray-600">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-medium text-white hover:bg-yellow-500"
          >
            Reload
          </button>
          <Link
            to="/"
            className="rounded-lg border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
