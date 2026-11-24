import type { ReactElement } from "react";
import { BookOpenText, BrainCircuit, Home, type LucideIcon } from "lucide-react";
import { HomePage } from "@/pages/home";
import { BrainPage } from "@/surfaces/brain/page";
import { GalleryPage } from "@/surfaces/gallery/page";
import { SharedUsagePage } from "@/surfaces/credits-hub/share";
import { RoadmapPage } from "@/surfaces/program/roadmap";
import { PortfolioPage } from "@/surfaces/program/portfolio";
import { HealthPage } from "@/surfaces/program/health";
import { TrustPage } from "@/surfaces/program/trust";

export interface AppRoute {
  path: string;
  element: ReactElement;
  label?: string;
  icon?: LucideIcon;
}

// Navigation is persona-driven (see components/nav.ts); these are the route patterns.
export const routes: AppRoute[] = [
  { path: "/", element: <HomePage />, label: "Home", icon: Home },
  { path: "/brain", element: <BrainPage />, label: "Brain", icon: BrainCircuit },
  { path: "/gallery", element: <GalleryPage />, label: "Component gallery", icon: BookOpenText },
  { path: "/roadmap", element: <RoadmapPage />, label: "Roadmap" },
  { path: "/portfolio", element: <PortfolioPage />, label: "Portfolio" },
  { path: "/health", element: <HealthPage />, label: "Product health" },
  { path: "/trust", element: <TrustPage />, label: "Trust and security" },
  { path: "/share/:id", element: <SharedUsagePage /> },
];
