import rasterio
from rasterio.mask import mask
import geopandas as gpd
import os
from PIL import Image
import numpy as np
import argparse
import json

def crop_and_save(orthomosaic_path, shapefile_path, output_dir, target_crs, merge_rgb):
    shapes = gpd.read_file(shapefile_path)
    shapes = shapes.to_crs(target_crs)

    with rasterio.open(orthomosaic_path) as src:
        shapes = shapes.to_crs(src.crs)
        os.makedirs(output_dir, exist_ok=True)

        for idx, row in shapes.iterrows():
            geometry = [row['geometry']]
            out_image, out_transform = mask(src, geometry, crop=True)

            shape_id = f"shape_{idx}"
            shape_dir = os.path.join(output_dir, shape_id)
            os.makedirs(shape_dir, exist_ok=True)

            # Save out_transform as JSON
            transform_path = os.path.join(shape_dir, "transform.json")
            transform_data = {
                "a": out_transform.a,
                "b": out_transform.b,
                "c": out_transform.c,
                "d": out_transform.d,
                "e": out_transform.e,
                "f": out_transform.f
            }
            with open(transform_path, "w") as f:
                json.dump(transform_data, f)

            # Prepare metadata for GeoTIFF
            out_meta = src.meta.copy()
            out_meta.update({
                "driver": "GTiff",
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform,
                "count": out_image.shape[0],
            })

            if np.ma.isMaskedArray(out_image):
                fill_value = src.nodata if src.nodata is not None else 0
                out_image = out_image.filled(fill_value)

            out_image = np.asarray(out_image)
            out_meta["dtype"] = out_image.dtype
            if src.nodata is not None:
                out_meta["nodata"] = src.nodata

            out_meta.setdefault("compress", "lzw")

            def normalize_and_save(band_data, file_path):
                """Convert band data to PNG using histogram stretching."""
                try:
                    from rasterio.plot import show
                    import matplotlib.pyplot as plt
                    
                    # Create a matplotlib figure
                    fig, ax = plt.subplots(figsize=(10, 10))
                    
                    # Use rasterio's show function which handles normalization automatically
                    show(band_data, ax=ax, cmap='gray')
                    ax.axis('off')
                    
                    # Save as PNG
                    plt.savefig(file_path, bbox_inches='tight', pad_inches=0, dpi=150)
                    plt.close()
                    
                except ImportError:
                    # Fallback to manual normalization if matplotlib not available
                    valid_data = band_data[np.isfinite(band_data)]
                    
                    if len(valid_data) == 0:
                        normalized_data = np.zeros_like(band_data, dtype=np.uint8)
                    else:
                        # Use a more aggressive percentile stretch
                        p1, p99 = np.percentile(valid_data, (1, 99))
                        stretched = np.clip((band_data - p1) / (p99 - p1), 0, 1)
                        normalized_data = (stretched * 255).astype(np.uint8)
                    
                    img = Image.fromarray(normalized_data)
                    img.save(file_path)

            # Save each band as a separate PNG
            for i in range(out_image.shape[0]):
                band_path = os.path.join(shape_dir, f"band_{i+1}.png")
                normalize_and_save(out_image[i], band_path)
                print(f"Saved band {i+1} for {shape_id}")

            # Optional RGB composite
            if merge_rgb and out_image.shape[0] >= 3:
                # For RGB, it's often better to normalize each channel independently
                # to maximize contrast in each.
                r_norm = (255 * (out_image[0] - out_image[0].min()) / (out_image[0].max() - out_image[0].min())).astype(np.uint8)
                g_norm = (255 * (out_image[1] - out_image[1].min()) / (out_image[1].max() - out_image[1].min())).astype(np.uint8)
                b_norm = (255 * (out_image[2] - out_image[2].min()) / (out_image[2].max() - out_image[2].min())).astype(np.uint8)
                
                rgb_array = np.stack([r_norm, g_norm, b_norm], axis=-1)
                rgb_path = os.path.join(shape_dir, "rgb.png")
                Image.fromarray(rgb_array).save(rgb_path)
                print(f"Saved RGB composite for {shape_id}")

            # If input is multispectral (more than 3 bands), save the NIR channel as a PNG
            if out_image.shape[0] > 3:
                # Assuming the 4th band is the NIR band.
                nir_path = os.path.join(shape_dir, "nir.png")
                normalize_and_save(out_image[3], nir_path)
                print(f"Saved NIR band for {shape_id}")

            # Save GeoTIFF
            tif_path = os.path.join(shape_dir, f"{shape_id}.tif")
            print(f"Number of bands: {out_image.shape[0]}")
            with rasterio.open(tif_path, "w", **out_meta) as dst:
                dst.write(out_image)

            print(f"Saved {out_image.shape[0]} band(s) for {shape_id}: {tif_path}")

            # Quick check
            with rasterio.open(tif_path) as check_src:
                print("Band count:", check_src.count)
                for i in range(1, check_src.count + 1):
                    band = check_src.read(i)
                    print(f"Band {i} min: {band.min()}, max: {band.max()}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crop orthomosaic using shapefile and save bands as PNGs and GeoTIFFs.")
    parser.add_argument("-m", "--orthomosaic", required=True, help="Path to orthomosaic TIFF file")
    parser.add_argument("-s", "--shapefile", required=True, help="Path to shapefile with crop shapes")
    parser.add_argument("-o", "--output", required=True, help="Directory to save cropped images")
    parser.add_argument("--crs", default="EPSG:4326", help="Target CRS for shapefile (default: EPSG:4326)")
    parser.add_argument("--rgb", "--merge-rgb", dest="merge_rgb", action="store_true", help="Merge first 3 bands into RGB image")

    args = parser.parse_args()
    crop_and_save(args.orthomosaic, args.shapefile, args.output, args.crs, args.merge_rgb)