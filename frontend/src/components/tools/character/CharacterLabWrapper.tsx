import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { CharacterPage } from "./CharacterPage";

export function CharacterLabWrapper() {
  return (
    <ProjectTabsWrapper storageKey="madison-charlab-projects" defaultProjectName="Project">
      {({ instanceId, active }) => (
        <CharacterPage instanceId={instanceId} active={active} />
      )}
    </ProjectTabsWrapper>
  );
}
