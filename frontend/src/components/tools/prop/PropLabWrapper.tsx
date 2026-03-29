import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { PropPage } from "./PropPage";

export function PropLabWrapper() {
  return (
    <ProjectTabsWrapper storageKey="madison-proplab-projects" defaultProjectName="Project">
      {({ instanceId, active }) => (
        <PropPage instanceId={instanceId} active={active} />
      )}
    </ProjectTabsWrapper>
  );
}
