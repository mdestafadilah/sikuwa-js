import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

export const Route = createRootRoute({
  component: () => (
    <>
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <nav className="max-w-5xl mx-auto h-16 px-6 flex items-center gap-6">
          <span className="font-bold text-white tracking-tight">
            SIKUWA<span className="text-emerald-400">.js</span>
          </span>
          <Link
            to="/"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
            activeProps={{ className: "text-sm text-emerald-400" }}
            activeOptions={{ exact: true }}
          >
            Template
          </Link>
          <Link
            to="/whatsapp"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
            activeProps={{ className: "text-sm text-emerald-400" }}
          >
            Playground
          </Link>
        </nav>
      </header>
      <Outlet />
      <TanStackRouterDevtools />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  ),
});
