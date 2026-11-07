import React from "react";
import { Network, Search, SlidersHorizontal, Box, Trash2, Move, FileCode, FilePen, Wrench, Layers, Play, Square, Terminal, Camera, Save, RotateCcw, MousePointerClick, Zap } from "lucide-react";
const MAP = { Network, Search, SlidersHorizontal, Box, Trash2, Move, FileCode, FilePen, Wrench, Layers, Play, Square, Terminal, Camera, Save, RotateCcw, MousePointerClick, Zap };
export default function Icon({ name, ...p }) { const C = MAP[name] || Box; return <C {...p} />; }
