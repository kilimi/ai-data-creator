import { SAMSession } from './session';
import { preprocessImage, imageToImageData, PreprocessedImage, ImageDataResult } from './preprocessor';
import { EncodingOutput } from './types';

export class SAMEncoder {
  private session: SAMSession | null = null;
  private cache = new Map<string, EncodingOutput>();

  async init(modelPath: string) {
    this.session = new SAMSession();
    await this.session.init(modelPath);
  }

  async encode(image: HTMLImageElement | string | ImageData, imageId: string): Promise<EncodingOutput> {
    // Check cache first
    if (this.cache.has(imageId)) {
      return this.cache.get(imageId)!;
    }

    if (!this.session) {
      throw new Error('Encoder not initialized. Call init() first.');
    }

    // Convert to ImageData if needed (with downsampling for large images)
    let imageData: ImageData;
    let originalWidth: number;
    let originalHeight: number;
    
    if (image instanceof ImageData) {
      imageData = image;
      originalWidth = imageData.width;
      originalHeight = imageData.height;
    } else {
      // imageToImageData handles downsampling and returns original dimensions
      const result: ImageDataResult = await imageToImageData(image as HTMLImageElement | string);
      imageData = result.imageData;
      originalWidth = result.originalWidth;
      originalHeight = result.originalHeight;
      
      if (originalWidth !== imageData.width || originalHeight !== imageData.height) {
        console.log(`[SAM] Image downsampled: ${originalWidth}x${originalHeight} -> ${imageData.width}x${imageData.height} (${((imageData.width / originalWidth) * 100).toFixed(1)}%)`);
      }
    }

    // Preprocess image (may return Promise for optimized path)
    // Pass original dimensions if image was downsampled
    const preprocessed = await Promise.resolve(preprocessImage(imageData, originalWidth, originalHeight));

    // Create input tensor
    const inputTensor = new ort.Tensor(
      'float32',
      preprocessed.tensor,
      [1, 3, preprocessed.processedHeight, preprocessed.processedWidth]
    );

    // Run encoder
    // Check input name - MobileSAM uses 'images', some models use 'x'
    const inputNames = this.session.getInputNames();
    const inputName = inputNames[0] || 'images'; // Default to 'images' for MobileSAM
    const outputs = await this.session.run({ [inputName]: inputTensor });

    // Get output name dynamically (different models may use different names)
    const outputNames = this.session.getOutputNames();
    const outputTensor = outputs[outputNames[0]];
    
    // Extract image embeddings
    // Output shape is typically [1, 256, 64, 64] for MobileSAM
    const imageEmbeddings = outputTensor.data as Float32Array;

    const encoding: EncodingOutput = {
      imageEmbeddings,
      originalWidth: preprocessed.originalWidth,
      originalHeight: preprocessed.originalHeight,
      processedWidth: preprocessed.processedWidth,
      processedHeight: preprocessed.processedHeight,
      scale: preprocessed.scale,
      offsetX: preprocessed.offsetX,
      offsetY: preprocessed.offsetY,
    };

    // Cache the encoding
    this.cache.set(imageId, encoding);

    return encoding;
  }

  clearCache() {
    this.cache.clear();
  }

  dispose() {
    this.session?.dispose();
    this.session = null;
    this.clearCache();
  }
}
