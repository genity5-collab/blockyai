import React from "react";
import { Network, Search, SlidersHorizontal, Box, Trash2, Move, FileCode, FilePen, Wrench, Layers, Play, Square, Terminal, Camera, Save, RotateCcw, MousePointerClick, Zap,
  Hammer, Package, Copy, Grid3x3, Route, FlipHorizontal, Scaling, AlignCenter, Columns3, ArrowDownToLine, Crosshair, Ruler, Video, Mountain, Sun, LayoutDashboard, Download, ListChecks, FolderSync, ShieldCheck } from "lucide-react";
const MAP = { Network, Search, SlidersHorizontal, Box, Trash2, Move, FileCode, FilePen, Wrench, Layers, Play, Square, Terminal, Camera, Save, RotateCcw, MousePointerClick, Zap,
  Hammer, Package, Copy, Grid3x3, Route, FlipHorizontal, Scaling, AlignCenter, Columns: Columns3, ArrowDownToLine, Crosshair, Ruler, Video, Mountain, Sun, LayoutDashboard, Download, ListChecks, FolderSync, ShieldCheck };
export default function Icon({ name, ...p }) { const C = MAP[name] || Box; return <C {...p} />; }
