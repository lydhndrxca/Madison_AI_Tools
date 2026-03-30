import { createContext, useContext } from "react";

const ActivePageContext = createContext<string>("character");

export const ActivePageProvider = ActivePageContext.Provider;
export const useActivePage = () => useContext(ActivePageContext);
