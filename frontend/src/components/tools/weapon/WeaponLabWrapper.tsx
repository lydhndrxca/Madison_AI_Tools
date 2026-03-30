import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { WeaponPage } from "./WeaponPage";

export function WeaponLabWrapper() {
  return (
    <ProjectTabsWrapper storageKey="madison-weaponlab-projects" defaultProjectName="Project">
      {({ instanceId, active, projectUid }) => (
        <WeaponPage instanceId={instanceId} active={active} projectUid={projectUid} />
      )}
    </ProjectTabsWrapper>
  );
}
