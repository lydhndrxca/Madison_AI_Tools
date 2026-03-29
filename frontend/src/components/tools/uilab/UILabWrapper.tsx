import { ProjectTabsWrapper } from "@/components/shared/ProjectTabsWrapper";
import { UILabPage } from "./UILabPage";

export function UILabWrapper() {
  return (
    <ProjectTabsWrapper storageKey="madison-uilab-projects" defaultProjectName="Project">
      {({ instanceId, active }) => (
        <UILabPage instanceId={instanceId} active={active} />
      )}
    </ProjectTabsWrapper>
  );
}
