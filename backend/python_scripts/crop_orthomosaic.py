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

            # Optional RGB composite
            if merge_rgb and out_image.shape[0] >= 3:
                rgb_array = np.stack([
                    out_image[0].astype(np.uint8),
                    out_image[1].astype(np.uint8),
                    out_image[2].astype(np.uint8)
                ], axis=-1)
                rgb_path = os.path.join(shape_dir, "rgb.png")
                Image.fromarray(rgb_array).save(rgb_path)
                print(f"Saved RGB composite for {shape_id}")

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