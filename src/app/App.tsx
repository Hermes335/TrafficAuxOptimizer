import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { PageStateProvider } from "./contexts/PageStateContext";

function SessionPages() {
  const { user, isAuthenticated } = useAuth();
  const session = isAuthenticated ? JSON.stringify([user?.id, user?.username, user?.role]) : "public";
  return <PageStateProvider key={session}><RouterProvider router={router} /></PageStateProvider>;
}

export default function App() {
  return (
    <AuthProvider>
      <SessionPages />
    </AuthProvider>
  );
}
