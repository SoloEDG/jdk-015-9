import type { SceneKind } from "../../../shared/types";
export const catalog: {
  kind: SceneKind;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    kind: "orbit",
    label: "Celestial orbit",
    icon: "◎",
    description: "粒子 / 环形频谱",
  },
  {
    kind: "spectrum",
    label: "Frequency field",
    icon: "▥",
    description: "频谱 / 垂直阵列",
  },
  {
    kind: "wave",
    label: "Liquid signal",
    icon: "∿",
    description: "波形 / 流体线条",
  },
  {
    kind: "tunnel",
    label: "Into the void",
    icon: "◇",
    description: "几何 / 无限隧道",
  },
];
