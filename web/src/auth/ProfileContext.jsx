import { createContext, useContext } from "react";

const ProfileContext = createContext({
    profiles: [],
    activeProfileId: null,
    switchProfile: () => {},
    createProfile: async () => {},
    updateProfile: async () => {},
    deleteProfile: async () => {},
    uploadAvatar: async () => {},
});

export function ProfileProvider({ children }) {
    return <ProfileContext.Provider value={ProfileContext._currentValue}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
    return useContext(ProfileContext);
}
