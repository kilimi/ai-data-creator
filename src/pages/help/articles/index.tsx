/**
 * Help article registry.
 *
 * To add a new article:
 *   1. Create a component under `src/pages/help/articles/`.
 *   2. Append an entry to `helpArticles` below.
 *   3. It will automatically appear in the sidebar and be routable at
 *      `/help/<slug>`.
 */
import { LucideIcon, Target, BookOpen, Images } from "lucide-react";
import { CollectionCalibrationArticle } from "./CollectionCalibrationArticle";
import { DatasetViewArticle } from "./DatasetViewArticle";

export interface HelpArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  icon: LucideIcon;
  Component: React.ComponentType;
}

export const helpArticles: HelpArticle[] = [
  {
    slug: "dataset-view",
    title: "Dataset View",
    description: "Browse images, manage collections, run auto-annotate and dataset actions.",
    category: "Datasets",
    icon: Images,
    Component: DatasetViewArticle,
  },
  {
    slug: "collection-calibration",
    title: "Collection Calibration",
    description: "Align two image collections (e.g. RGB ↔ Thermal) using point pairs.",
    category: "Datasets",
    icon: Target,
    Component: CollectionCalibrationArticle,
  },
  // Add more articles here — they will show up in the sidebar automatically.
];

export const placeholderIcon = BookOpen;
