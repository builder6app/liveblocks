import React, { ComponentProps, forwardRef, Ref } from "react";
import { useGLTF } from "@react-three/drei";
import { FurnitureModels } from "./types";
import { Group } from "three";

export const CoffeeTable = forwardRef(
  (props: ComponentProps<"group">, ref: Ref<Group>) => {
    const { nodes, materials } = useGLTF("/furniture.glb") as FurnitureModels;

    return (
      <group {...props} ref={ref} dispose={null}>
        <group position={[0, 0.195, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTable_1.geometry}
            material={materials.coffeeTableMetal}
          />
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTable_2.geometry}
            material={materials.coffeeTableGlass}
          />
        </group>
        <group position={[0.2, 0.495, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTablePlant1_1.geometry}
            material={materials.coffeeTableWood}
          />
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTablePlant1_2.geometry}
            material={materials.coffeeTablePlant}
          />
        </group>
        <group position={[-0.2, 0.495, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTablePlant2_1.geometry}
            material={materials.coffeeTableWood}
          />
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.coffeeTablePlant2_2.geometry}
            material={materials.coffeeTablePlant}
          />
        </group>
      </group>
    );
  }
);

useGLTF.preload("/furniture.glb");