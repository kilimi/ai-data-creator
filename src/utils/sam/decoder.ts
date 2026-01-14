import { SAMSession } from './session';
import { EncodingOutput, SAMPrompt, SAMResult, Point, SegmentationMask } from './types';
import * as ort from 'onnxruntime-web';

export class SAMDecoder {
  private session: SAMSession | null = null;

  async init(modelPath: string) {
    this.session = new SAMSession();
    await this.session.init(modelPath);
  }

  async decode(
    encoding: EncodingOutput,
    prompt: SAMPrompt
  ): Promise<SAMResult> {
    if (!this.session) {
      throw new Error('Decoder not initialized. Call init() first.');
    }

    try {
      // Prepare decoder inputs
      const inputs = this.prepareDecoderInputs(encoding, prompt);

      // Run decoder
      console.log('[SAM] Running decoder with inputs:', Object.keys(inputs));
      const outputs = await this.session.run(inputs);
      console.log('[SAM] Decoder outputs:', Object.keys(outputs));

      // Post-process outputs to get masks and polygons
      const result = this.postprocessOutputs(outputs, encoding);
      console.log('[SAM] Decoder result:', { 
        numMasks: result.masks.length, 
        numPolygons: result.polygons.length,
        polygonPoints: result.polygons[0]?.length || 0
      });
      
      return result;
    } catch (error) {
      console.error('[SAM] Decoder error:', error);
      throw error;
    }
  }

  private prepareDecoderInputs(encoding: EncodingOutput, prompt: SAMPrompt): ort.InferenceSession.OnnxValueMapType {
    const inputs: ort.InferenceSession.OnnxValueMapType = {};

    // Image embeddings
    inputs.image_embeddings = new ort.Tensor(
      'float32',
      encoding.imageEmbeddings,
      [1, 256, 64, 64] // Typical MobileSAM shape
    );

    // Points and labels
    if (prompt.points && prompt.points.length > 0) {
      const points = prompt.points;
      const labels = prompt.labels || points.map(p => p.label);
      
      // Scale points to processed image size (1024x1024)
      // Account for both scaling and padding offset
      // GETI approach: scale = 1024 / max(originalWidth, originalHeight)
      // Points are in original image coordinates, need to:
      // 1. Scale by the preprocessing scale factor
      // 2. Add the padding offset
      const scale = encoding.scale;
      const offsetX = encoding.offsetX;
      const offsetY = encoding.offsetY;
      
      console.log('[SAM] Point scaling:', {
        originalPoints: points.slice(0, 2),
        scale,
        offsetX,
        offsetY,
        originalSize: `${encoding.originalWidth}x${encoding.originalHeight}`,
        processedSize: `${encoding.processedWidth}x${encoding.processedHeight}`,
      });

      // Prepare point coordinates: [N, 2]
      const pointCoords = new Float32Array(points.length * 2);
      for (let i = 0; i < points.length; i++) {
        // Scale point and add offset to account for padding
        pointCoords[i * 2] = points[i].x * scale + offsetX;
        pointCoords[i * 2 + 1] = points[i].y * scale + offsetY;
      }
      
      console.log('[SAM] Scaled point coords:', Array.from(pointCoords).slice(0, 4));

      // Prepare point labels: [N]
      const pointLabels = new Float32Array(labels);

      inputs.point_coords = new ort.Tensor('float32', pointCoords, [1, points.length, 2]);
      inputs.point_labels = new ort.Tensor('float32', pointLabels, [1, points.length]);
    } else {
      // No points - use default
      inputs.point_coords = new ort.Tensor('float32', new Float32Array([0, 0]), [1, 1, 2]);
      inputs.point_labels = new ort.Tensor('float32', new Float32Array([-1]), [1, 1]);
    }

    // Box (optional)
    if (prompt.boxes && prompt.boxes.length > 0) {
      const box = prompt.boxes[0];
      const scaleX = encoding.processedWidth / encoding.originalWidth;
      const scaleY = encoding.processedHeight / encoding.originalHeight;
      
      const boxCoords = new Float32Array([
        box.x1 * scaleX,
        box.y1 * scaleY,
        box.x2 * scaleX,
        box.y2 * scaleY,
      ]);
      inputs.box = new ort.Tensor('float32', boxCoords, [1, 4]);
    }

    // Mask input (optional, for refinement)
    // Use zeros for first pass (no previous mask)
    const maskInput = new Float32Array(256 * 256).fill(0);
    inputs.mask_input = new ort.Tensor('float32', maskInput, [1, 1, 256, 256]);

    // Has mask input flag (0 = no mask, 1 = has mask)
    inputs.has_mask_input = new ort.Tensor('float32', new Float32Array([0]), [1]);

    // Original image size (required by SAM decoder)
    // GETI calculates this as: ratio = 1024 / max(originalHeight, originalWidth)
    // Then: [round(originalHeight * ratio), round(originalWidth * ratio)]
    const ratio = 1024 / Math.max(encoding.originalHeight, encoding.originalWidth);
    inputs.orig_im_size = new ort.Tensor(
      'float32',
      new Float32Array([
        Math.round(encoding.originalHeight * ratio),
        Math.round(encoding.originalWidth * ratio)
      ]),
      [2]
    );
    
    console.log('[SAM] orig_im_size:', {
      original: [encoding.originalHeight, encoding.originalWidth],
      ratio,
      scaled: [Math.round(encoding.originalHeight * ratio), Math.round(encoding.originalWidth * ratio)],
    });

    return inputs;
  }

  private postprocessOutputs(
    outputs: ort.InferenceSession.OnnxValueMapType,
    encoding: EncodingOutput
  ): SAMResult {
    // Get output names dynamically
    const outputNames = this.session.getOutputNames();
    
    // SAM decoder outputs: masks, iou_predictions, low_res_masks
    const masksTensor = outputs['masks'] || outputs[outputNames.find(n => n.includes('mask')) || outputNames[0]];
    const iouPredictions = outputs['iou_predictions'] || outputs[outputNames.find(n => n.includes('iou')) || outputNames[1]];
    
    if (!masksTensor) {
      console.error('No masks tensor found in decoder output', outputNames, Object.keys(outputs));
      return { masks: [], polygons: [], scores: [] };
    }

    const masks = masksTensor.data as Float32Array;
    const iouScores = iouPredictions ? (iouPredictions.data as Float32Array) : null;
    
    // Get mask dimensions from tensor shape
    // SAM decoder outputs masks as [batch, num_masks, height, width]
    // GETI uses: masks.dims[2] for height, masks.dims[3] for width
    const dims = masksTensor.dims;
    console.log('[SAM] Mask tensor dims:', dims);
    
    const numMasks = dims.length >= 4 ? dims[1] : 1;
    const maskHeight = dims.length >= 4 ? dims[2] : dims[dims.length - 2] || 256;
    const maskWidth = dims.length >= 4 ? dims[3] : dims[dims.length - 1] || 256;
    const maskSize = maskHeight * maskWidth; // Total pixels per mask
    
    console.log('[SAM] Mask dimensions:', {
      numMasks,
      maskHeight,
      maskWidth,
      maskSize,
      tensorShape: dims,
    });
    
    // Find best mask using IoU predictions (like GETI does)
    let bestMaskIdx = 0;
    if (iouScores && iouScores.length > 0) {
      console.log('[SAM] IoU scores:', Array.from(iouScores));
      for (let i = 0; i < Math.min(numMasks, iouScores.length); i++) {
        if (iouScores[i] > iouScores[bestMaskIdx]) {
          bestMaskIdx = i;
        }
      }
      console.log('[SAM] Best mask index:', bestMaskIdx, 'with IoU:', iouScores[bestMaskIdx]);
    }

    const resultMasks: SegmentationMask[] = [];
    const resultPolygons: Point[][] = [];
    const resultScores: number[] = [];

    // Process only the best mask (like GETI does)
    const score = iouScores && iouScores.length > bestMaskIdx ? iouScores[bestMaskIdx] : 1.0;
    
    // GETI calculates: maskOffset = maskIdx * size, where size = dims[2] * dims[3]
    const maskOffset = bestMaskIdx * maskSize;
    
    // Extract mask - SAM outputs logits that need to be thresholded
    // GETI uses: value = Number(masks.data[maskOffset + y * masks.dims[3] + x])
    const maskData = new Uint8Array(maskSize);
    let minVal = Infinity;
    let maxVal = -Infinity;
    let positiveCount = 0;
    
    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        // GETI's indexing: maskOffset + y * width + x
        const dataIdx = maskOffset + y * maskWidth + x;
        const val = masks[dataIdx];
        const maskIdx = y * maskWidth + x;
        
        minVal = Math.min(minVal, val);
        maxVal = Math.max(maxVal, val);
        // SAM outputs logits - threshold at 0.0
        // Positive values = foreground, negative = background
        if (val > 0.0) positiveCount++;
        maskData[maskIdx] = val > 0.0 ? 255 : 0;
      }
    }
    
    console.log('[SAM] Mask stats:', {
      minVal: minVal.toFixed(3),
      maxVal: maxVal.toFixed(3),
      positivePixels: positiveCount,
      totalPixels: maskSize * maskSize,
      ratio: (positiveCount / (maskSize * maskSize)).toFixed(3),
    });

    const mask: SegmentationMask = {
      mask: maskData,
      width: maskWidth,
      height: maskHeight,
      score,
    };

    // Convert mask to polygon
    const polygon = this.maskToPolygon(mask, encoding);
    
    // Filter out masks that are too large (>90% of image area) or too small (<1%)
    if (polygon.length > 0) {
      const imageArea = encoding.originalWidth * encoding.originalHeight;
      const maskArea = this.calculatePolygonArea(polygon);
      const areaRatio = maskArea / imageArea;
      
      console.log('[SAM] Polygon stats:', {
        numPoints: polygon.length,
        area: maskArea.toFixed(0),
        imageArea: imageArea.toFixed(0),
        ratio: (areaRatio * 100).toFixed(2) + '%',
        firstFewPoints: polygon.slice(0, 5),
      });
      
      // Skip if mask is too large (likely wrong) or too small (likely noise)
      if (areaRatio > 0.9) {
        console.warn('[SAM] Mask too large, skipping', { areaRatio, maskArea, imageArea });
        return { masks: [], polygons: [], scores: [] };
      }
      
      if (areaRatio < 0.01) {
        console.warn('[SAM] Mask too small, skipping', { areaRatio, maskArea, imageArea });
        return { masks: [], polygons: [], scores: [] };
      }
    } else {
      console.warn('[SAM] No polygon found in mask');
      return { masks: [], polygons: [], scores: [] };
    }

    return {
      masks: [mask],
      polygons: [polygon],
      scores: [score],
    };
  }

  private maskToPolygon(mask: SegmentationMask, encoding: EncodingOutput): Point[] {
    // Scale mask coordinates to original image size
    // GETI uses: scaleX = (x * originalWidth) / maskWidth
    // This scales from mask space (256x256) to original image space
    const scaleX = (x: number) => Math.round((x * encoding.originalWidth) / mask.width);
    const scaleY = (y: number) => Math.round((y * encoding.originalHeight) / mask.height);

    // Find contours in mask (in mask space, 256x256)
    const contours = this.findContours(mask.mask, mask.width, mask.height);

    if (contours.length === 0) {
      console.warn('[SAM] No contours found in mask');
      return [];
    }

    // Get largest contour
    const largestContour = contours.reduce((a, b) => 
      a.length > b.length ? a : b
    );

    console.log('[SAM] Contour found:', {
      numContours: contours.length,
      largestContourPoints: largestContour.length,
      maskSize: `${mask.width}x${mask.height}`,
      originalSize: `${encoding.originalWidth}x${encoding.originalHeight}`,
      firstFewPoints: largestContour.slice(0, 5),
    });

    // Scale points from mask space to original image space
    const scaledPoints = largestContour.map(p => ({
      x: scaleX(p.x),
      y: scaleY(p.y),
    }));
    
    // Simplify polygon (remove duplicate/close points)
    const simplified = this.simplifyPolygon(scaledPoints);
    
    console.log('[SAM] Scaled polygon:', {
      originalPoints: largestContour.length,
      simplifiedPoints: simplified.length,
      firstFewScaled: simplified.slice(0, 5),
    });
    
    return simplified;
  }
  
  private calculatePolygonArea(points: Point[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
  }
  
  private simplifyPolygon(points: Point[], threshold: number = 2): Point[] {
    if (points.length <= 3) return points;
    
    const simplified: Point[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const curr = points[i];
      const next = points[i + 1];
      
      // Calculate distance from current point to line between prev and next
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const dist = Math.abs((dy * curr.x - dx * curr.y + next.x * prev.y - next.y * prev.x) / Math.sqrt(dx * dx + dy * dy));
      
      // Keep point if it's far enough from the line
      if (dist > threshold) {
        simplified.push(curr);
      }
    }
    simplified.push(points[points.length - 1]);
    return simplified;
  }

  private findContours(mask: Uint8Array, width: number, height: number): Point[][] {
    // Simplified contour finding using marching squares algorithm
    // For production, consider using a library like OpenCV.js or a dedicated contour finder
    
    const contours: Point[][] = [];
    const visited = new Set<string>();

    // Find all edge pixels (pixels with value 255 adjacent to value 0)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (mask[idx] === 255 && !visited.has(`${x},${y}`)) {
          // Found a new contour
          const contour = this.traceContour(mask, width, height, x, y, visited);
          if (contour.length > 0) {
            contours.push(contour);
          }
        }
      }
    }

    return contours;
  }

  private traceContour(
    mask: Uint8Array,
    width: number,
    height: number,
    startX: number,
    startY: number,
    visited: Set<string>
  ): Point[] {
    const contour: Point[] = [];
    const directions = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1]
    ];

    let x = startX;
    let y = startY;
    let dir = 0;

    do {
      visited.add(`${x},${y}`);
      contour.push({ x, y });

      // Find next edge pixel
      let found = false;
      for (let i = 0; i < 8; i++) {
        const checkDir = (dir + i) % 8;
        const [dx, dy] = directions[checkDir];
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = ny * width + nx;
          if (mask[idx] === 255) {
            x = nx;
            y = ny;
            dir = (checkDir + 6) % 8; // Turn left
            found = true;
            break;
          }
        }
      }

      if (!found) break;
    } while (x !== startX || y !== startY || contour.length === 1);

    return contour;
  }

  dispose() {
    this.session?.dispose();
    this.session = null;
  }
}
