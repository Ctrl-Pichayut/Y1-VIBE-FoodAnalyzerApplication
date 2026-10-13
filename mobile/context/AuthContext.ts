import { createContext } from 'react';

export interface AuthContextType {
  isAdmin: boolean;
  setIsAdmin: (isAdmin: boolean) => void;
}

export const AuthContext = createContext<AuthContextType>({
  isAdmin: false,
  setIsAdmin: () => {},
});
