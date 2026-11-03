"""Tessellate a STEP file into plain triangle meshes for the browser viewer.

Invoked by the plugin Host as a throwaway subprocess:

    python parse-step.py <input.step> <output.json> [display name]

Requires OCP (the OpenCascade Python binding shipped by ``cadquery-ocp``).

OCP lookup order:
  1. a normal ``import OCP`` (works when OCP is installed in this interpreter)
  2. ``PRODUCT_MODEL_OCP_PATH``: one directory or several separated by
     ``os.pathsep`` that contain an ``OCP`` package

The script writes nothing except the requested JSON file and never touches the
source STEP file.
"""
import json
import os
import sys

for candidate in (os.environ.get('PRODUCT_MODEL_OCP_PATH') or '').split(os.pathsep):
    if candidate and candidate not in sys.path:
        sys.path.insert(0, candidate)

from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS


def tessellate(shape, linear_deflection=0.8, angular_deflection=0.35):
    BRepMesh_IncrementalMesh(shape, linear_deflection, False, angular_deflection, True)
    positions, indices = [], []
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        face = TopoDS.Face(faces.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation:
            offset = len(positions) // 3
            transform = location.Transformation()
            for i in range(1, triangulation.NbNodes() + 1):
                point = triangulation.Node(i).Transformed(transform)
                positions.extend([round(point.X(), 5), round(point.Y(), 5), round(point.Z(), 5)])
            for i in range(1, triangulation.NbTriangles() + 1):
                a, b, c = [triangulation.Triangle(i).Value(j) - 1 + offset for j in (1, 2, 3)]
                if face.Orientation() == TopAbs_REVERSED:
                    b, c = c, b
                indices.extend([a, b, c])
        faces.Next()
    return positions, indices


def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: parse-step.py <input.step> <output.json> [name]')
    source, destination = sys.argv[1], sys.argv[2]
    name = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(source)

    reader = STEPControl_Reader()
    if reader.ReadFile(source) != IFSelect_RetDone:
        raise ValueError('无法读取 STEP 文件')
    if not reader.TransferRoots():
        raise ValueError('STEP 文件没有可转换的几何')

    shape = reader.OneShape()
    solids, items = TopExp_Explorer(shape, TopAbs_SOLID), []
    while solids.More():
        items.append(TopoDS.Solid(solids.Current()))
        solids.Next()

    parts = []
    for solid in items or [shape]:
        positions, indices = tessellate(solid)
        if indices:
            parts.append({
                'id': len(parts) + 1,
                'name': f'实体 {len(parts) + 1}',
                'positions': positions,
                'indices': indices,
            })
    if not parts:
        raise ValueError('没有可显示的网格')

    with open(destination, 'w', encoding='utf-8') as handle:
        json.dump({'name': name, 'unit': 'mm', 'parts': parts}, handle, ensure_ascii=False)


if __name__ == '__main__':
    main()
