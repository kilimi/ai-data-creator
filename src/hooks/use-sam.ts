import { useQuery } from '@tanstack/react-query';
import { wrap, Remote } from 'comlink';
import { useCallback, useRef, useState, useEffect } from 'react';
import { EncodingOutput, SAMPrompt, SAMResult, Point } from '../utils/sam/types';

// Import worker with Vite's worker syntax
import SAMWorker from '../workers/sam.worker?worker';

const ENCODER_MODEL_PATH = '/models/sam/mobile_sam.encoder.onnx';
const DECODER_MODEL_PATH = '/models/sam/sam_vit_h_4b8939.decoder.onnx';

interface UseSAMOptions {
  image: HTMLImageElement | string | ImageData | null;
  imageId: string;
  enabled?: boolean;
  preloadModels?: boolean; // If true, start loading models immediately, not waiting for image
}

export function useSAM({ image, imageId, enabled = true, preloadModels = false }: UseSAMOptions) {
  const workerRef = useRef<Remote<any> | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Initialize worker - start loading models immediately if preloadModels is true
  // Otherwise, wait for image to be available (backward compatibility)
  // When preloadModels is true, start loading immediately regardless of image availability
  const shouldInitWorker = preloadModels || (enabled && !!image);
  
  console.log('[SAM] useSAM hook called:', {
    preloadModels,
    enabled,
    hasImage: !!image,
    imageId,
    shouldInitWorker,
    hasWorker: !!workerRef.current,
  });
  
  const { data: worker, isLoading: isWorkerLoading } = useQuery({
    queryKey: ['sam-worker'],
    queryFn: async () => {
      if (workerRef.current) {
        console.log('[SAM] Worker already exists, reusing');
        return workerRef.current;
      }

      setIsInitializing(true);
      try {
        console.log('[SAM] ===== Starting SAM model initialization =====');
        console.log('[SAM] Creating worker...');
        const w = wrap<any>(new SAMWorker());
        console.log('[SAM] Worker created, loading encoder model:', ENCODER_MODEL_PATH);
        console.log('[SAM] Worker created, loading decoder model:', DECODER_MODEL_PATH);
        await w.init(ENCODER_MODEL_PATH, DECODER_MODEL_PATH);
        console.log('[SAM] ===== Models loaded successfully =====');
        workerRef.current = w;
        return w;
      } catch (error) {
        console.error('[SAM] ===== Error initializing worker =====', error);
        throw error;
      } finally {
        setIsInitializing(false);
      }
    },
    staleTime: Infinity,
    enabled: shouldInitWorker && !workerRef.current, // Only start if we should init and don't have a worker yet
  });
  
  // Log when worker loading state changes
  useEffect(() => {
    if (isWorkerLoading) {
      console.log('[SAM] Worker is loading...');
    } else if (worker) {
      console.log('[SAM] Worker is ready');
    }
  }, [isWorkerLoading, worker]);

  // Encode image (cached per image)
  const { data: encoding, isLoading: isEncoding, error: encodingError } = useQuery({
    queryKey: ['sam-encoding', imageId],
    queryFn: async () => {
      console.log('[SAM] Starting image encoding:', { imageId, hasWorker: !!worker, hasImage: !!image });
      if (!worker || !image) {
        throw new Error('Worker or image not available');
      }
      const result = await worker.encodeImage(image, imageId);
      console.log('[SAM] Image encoding complete:', {
        imageId,
        originalSize: `${result.originalWidth}x${result.originalHeight}`,
        processedSize: `${result.processedWidth}x${result.processedHeight}`,
        scale: result.scale,
      });
      return result;
    },
    enabled: enabled && !!worker && !!image && !!imageId,
    staleTime: Infinity,
    gcTime: 3600 * 1000, // 1 hour cache
  });

  // Decode function
  const decode = useCallback(
    async (points: Point[]): Promise<SAMResult | null> => {
      console.log('[SAM] decode called:', {
        hasWorker: !!worker,
        hasEncoding: !!encoding,
        numPoints: points.length,
        points: points.slice(0, 2),
        encoding: encoding ? {
          originalSize: `${encoding.originalWidth}x${encoding.originalHeight}`,
          processedSize: `${encoding.processedWidth}x${encoding.processedHeight}`,
          scale: encoding.scale,
        } : null,
      });

      if (!worker || !encoding || points.length === 0) {
        console.warn('[SAM] decode early return:', { hasWorker: !!worker, hasEncoding: !!encoding, pointsLength: points.length });
        return null;
      }

      const prompt: SAMPrompt = {
        points,
        labels: points.map(p => p.label),
      };

      try {
        console.log('[SAM] Calling worker.decodeMask with prompt:', prompt);
        const result = await worker.decodeMask(encoding, prompt);
        console.log('[SAM] worker.decodeMask result:', result);
        return result;
      } catch (error) {
        console.error('[SAM] decode error:', error);
        return null;
      }
    },
    [worker, encoding]
  );

  return {
    encoding,
    decode,
    isLoading: isWorkerLoading || isInitializing || isEncoding,
    isReady: !!worker && !!encoding,
    error: encodingError,
  };
}
