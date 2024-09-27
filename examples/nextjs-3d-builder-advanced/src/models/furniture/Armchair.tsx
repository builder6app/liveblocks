import React, { ComponentProps, forwardRef, Ref } from "react";
import { useGLTF } from "@react-three/drei";
import { FurnitureModels } from "./types";
import { Group } from "three";

export const Armchair = forwardRef(
  (props: ComponentProps<"group">, ref: Ref<Group>) => {
    const { nodes, materials } = useGLTF("/furniture.glb") as FurnitureModels;

    return (
      <group {...props} ref={ref} dispose={null}>
        <group position={[0, 0.424, 0.033]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.armchair_1.geometry}
            material={materials.armchairFabric}
          />
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.armchair_2.geometry}
            material={materials.armchairWood}
          />
        </group>
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.armchairPillow.geometry}
          material={materials.armchairFabric}
          position={[0.031, 0.71, 0.122]}
          rotation={[Math.PI / 2, 0, -0.126]}
        />
      </group>
    );
  }
);

useGLTF.preload("/furniture.glb");