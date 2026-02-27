import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings, Sparkles, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { TasksPopover } from "./TasksPopover";
import { useTheme } from "./ThemeProvider";

export function Navbar() {
  const location = useLocation();
  const pathname = location.pathname;
  const params = useParams<{ projectId?: string; id?: string }>();
  // Use projectId only when it's actually a project: /projects/:projectId/datasets/... has projectId.
  // On /datasets/:id the param "id" is the dataset id — never use it as projectId or we fetch wrong tasks.
  // On /projects/:id (project layout) the param "id" is the project id.
  const projectIdNum = params.projectId
    ? parseInt(params.projectId, 10)
    : pathname.startsWith("/datasets/")
      ? undefined
      : params.id
        ? parseInt(params.id, 10)
        : undefined;
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggleTheme } = useTheme();
  
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300",
        scrolled ? "nav-blur" : "bg-transparent"
      )}
    >
      <div className="flex h-full items-center justify-between w-full px-4">
        <div className="flex items-center gap-6">
          <Link 
            to="/" 
            className="flex items-center gap-3 text-xl font-bold tracking-tight group"
          >
            <div className="relative">
              <Sparkles className="w-6 h-6 text-primary animate-pulse-soft group-hover:animate-spin transition-all duration-300" />
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <span className="bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent group-hover:from-accent group-hover:via-primary group-hover:to-secondary transition-all duration-300">
              LAI
            </span>
          </Link>
        </div>
        
        <div className="flex items-center gap-2">
          <TasksPopover />
          
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            asChild
          >
            <Link to="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
