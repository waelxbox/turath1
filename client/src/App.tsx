import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import ValidationReviewPortal from "./pages/ValidationReviewPortal";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/projects/:id/onboarding" component={Onboarding} />
      {/* Sandboxed Review Portal — no auth, no nav */}
      <Route path="/review/:token" component={ValidationReviewPortal} />
      {/* All project sub-routes handled inside ProjectWorkspace via nested Router base */}
      <Route path="/projects/:id/*" component={ProjectWorkspace} />
      <Route path="/projects/:id" component={ProjectWorkspace} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={true}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
