import json
import geopandas as gpd
from shapely.geometry import Polygon
import os
import argparse
from rasterio.transform import Affine

def load_transform(transform_path):
    with open(transform_path, "r") as f:
        t = json.load(f)
    return Affine(t["a"], t["b"], t["c"], t["d"], t["e"], t["f"])

def pixel_to_global_coords(transform, x, y):
    return transform * (x, y)

def convert_coco_to_shapefile(coco_path, output_dir, crs_code, transform_path):
    # Load COCO JSON
    with open(coco_path, "r") as f:
        coco_data = json.load(f)

    # Load single transform
    transform = load_transform(transform_path)

    # Prepare lookup tables
    image_lookup = {img["id"]: img for img in coco_data["images"]}
    category_lookup = {cat["id"]: cat["name"] for cat in coco_data["categories"]}

    features = []

    for ann in coco_data["annotations"]:
        image = image_lookup[ann["image_id"]]
        category = category_lookup[ann["category_id"]]
        file_name = image["file_name"]

        for seg in ann["segmentation"]:
            pixel_coords = [(seg[i], seg[i + 1]) for i in range(0, len(seg), 2)]
            global_coords = [pixel_to_global_coords(transform, x, y) for x, y in pixel_coords]
            polygon = Polygon(global_coords)

            features.append({
                "geometry": polygon,
                "image_id": ann["image_id"],
                "annotation_id": ann["id"],
                "category": category,
                "file_name": file_name
            })

    # Create GeoDataFrame with original CRS
    gdf = gpd.GeoDataFrame(features, crs=crs_code)

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{output_dir}.shp")
    gdf.to_file(output_path)

    print(f"✅ Shapefile saved to: {output_path} with CRS: {crs_code}")

# === Argument Parser ===
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert COCO annotations to geospatial Shapefile")
    parser.add_argument("--coco", required=True, help="Path to COCO annotation JSON file")
    parser.add_argument("--out", required=True, help="Output directory for Shapefile")
    parser.add_argument("--crs", default="EPSG:25832", help="Coordinate Reference System (default: EPSG:25832)")
    parser.add_argument("--transform", required=True, help="Path to transform.json file")

    args = parser.parse_args()
    convert_coco_to_shapefile(args.coco, args.out, args.crs, args.transform)