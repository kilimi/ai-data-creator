/**
 * Help article: Collection Calibration
 *
 * Explains what calibration is, why it matters, and walks through the
 * 5-step flow used inside <CalibrationDialog />.
 */
import { Target, MousePointerClick, Layers, Pencil, Save, Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArticleSection, ArticleStep, ArticleCallout } from "../components/ArticleParts";

export function CollectionCalibrationArticle() {
  return (
    <article className="space-y-8 max-w-3xl">
      {/* Header */}
      <header className="space-y-3">
        <Badge variant="secondary" className="gap-1.5">
          <Target className="h-3.5 w-3.5" /> Datasets
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">Collection Calibration</h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Align two image collections of the same scene captured by different
          sensors — for example RGB ↔ Thermal — so an annotation made on one
          collection can be projected onto the other.
        </p>
      </header>

      {/* Why */}
      <ArticleSection id="why" title="Why calibrate?" icon={Lightbulb}>
        <p>
          When the same scene is captured by two cameras (different sensors,
          positions or lenses), the pixels do not line up. Calibration computes
          a <strong>homography</strong> — a 3×3 transform — from a handful of
          matching points you click on both images. Once saved, every future
          annotation drawn on the source collection can be projected onto the
          target collection automatically.
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>Annotate once, get labels on both modalities.</li>
          <li>Verify sensor alignment after a hardware change.</li>
          <li>Spot calibration drift between captures.</li>
        </ul>
      </ArticleSection>

      {/* Steps */}
      <ArticleSection id="how" title="How to calibrate, step by step" icon={MousePointerClick}>
        <ArticleStep
          n={1}
          title="Pick two collections"
          icon={Layers}
        >
          Open the dataset and click <strong>Calibrate Collections</strong>. In
          the dialog, choose a <em>Source</em> collection (left) and a <em>Target</em>
          collection (right). They must be different and contain images.
        </ArticleStep>

        <ArticleStep
          n={2}
          title="Load a matching image pair"
          icon={Target}
        >
          Click <strong>Load images</strong>. If both collections share file
          names, the matching pair is loaded; otherwise a random pair appears.
          Use <strong>Next images</strong> any time to swap to a fresh pair —
          your existing point pairs are kept.
        </ArticleStep>

        <ArticleStep
          n={3}
          title="Mark matching point pairs"
          icon={MousePointerClick}
        >
          Click a recognizable spot on one image (a corner, a marker, a feature
          edge), then click the <em>same</em> physical spot on the other image.
          That forms one pair, drawn as a numbered colored marker on both sides.
          <ArticleCallout tone="info" className="mt-3">
            You need at least <strong>4 pairs</strong> to compute a homography.
            For reliable results, aim for <strong>8–15 pairs</strong> spread
            across the frame and across multiple image pairs (use{" "}
            <em>Next images</em> between batches).
          </ArticleCallout>
        </ArticleStep>

        <ArticleStep
          n={4}
          title="Compute the calibration"
          icon={Target}
        >
          Click <strong>Compute Calibration</strong>. We fit the alignment and
          show validation metrics (mean/max reprojection error, inliers,
          outliers, and a quality grade: excellent → good → fair → poor). After
          computing, hover either image to see a cyan crosshair projected on
          the other side — that is your live alignment preview.
        </ArticleStep>

        <ArticleStep
          n={5}
          title="Verify in the Test tab, then Save"
          icon={Pencil}
        >
          Switch to the <strong>Test</strong> tab and draw freehand strokes on
          either side. Strokes drawn locally are coral; their projection onto
          the other side is shown as a blue dashed line. If alignment looks
          good, click <strong>Save Calibration</strong>.
          <span className="block mt-2 text-muted-foreground">
            <Save className="inline h-3.5 w-3.5 mr-1 align-text-bottom" />
            Saved calibrations live with the dataset and are reused
            automatically.
          </span>
        </ArticleStep>
      </ArticleSection>

      {/* Quality tips */}
      <ArticleSection id="tips" title="Tips for accurate calibration" icon={Lightbulb}>
        <Card className="p-4 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="font-semibold mb-1">✅ Do</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Pick sharp, locally-unique features (corners, markers).</li>
              <li>Spread pairs across all four quadrants of the frame.</li>
              <li>Use a few different image pairs, not just one.</li>
              <li>Recompute after adding more pairs to improve quality.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-1">⛔ Avoid</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Clustering points in one region.</li>
              <li>Using ambiguous spots (smooth surfaces, repeating patterns).</li>
              <li>Mixing scenes with very different depth from very flat ones.</li>
            </ul>
          </div>
        </Card>
      </ArticleSection>

      {/* Reading the metrics */}
      <ArticleSection id="metrics" title="Reading the validation metrics">
        <ul className="space-y-2 text-sm">
          <li>
            <Badge>excellent</Badge>{" "}
            <span className="text-muted-foreground">
              Mean error &lt; 5 px — safe for precise alignment.
            </span>
          </li>
          <li>
            <Badge variant="secondary">good</Badge>{" "}
            <span className="text-muted-foreground">
              Mean error &lt; 15 px — acceptable for most use cases.
            </span>
          </li>
          <li>
            <Badge variant="outline">fair</Badge>{" "}
            <span className="text-muted-foreground">
              Mean error &lt; 30 px — add more points across more scenes.
            </span>
          </li>
          <li>
            <Badge variant="destructive">poor</Badge>{" "}
            <span className="text-muted-foreground">
              High error — re-check pairs and add 10–15 fresh ones.
            </span>
          </li>
        </ul>
      </ArticleSection>
    </article>
  );
}
