
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Database, FolderPlus, Home, Settings, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  
  // Track scroll position to add blur effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  
  // Check if we're in a project view
  const isProjectView = location.pathname.startsWith('/projects/') && location.pathname !== '/projects/new';
  
  const navItems = [
    { 
      name: "Home", 
      path: "/", 
      icon: <Home className="w-4 h-4 mr-2" /> 
    },
    { 
      name: "Projects", 
      path: "/", 
      icon: <FolderOpen className="w-4 h-4 mr-2" /> 
    },
    { 
      name: "Datasets", 
      path: "/datasets", 
      icon: <Database className="w-4 h-4 mr-2" /> 
    },
  ];

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex h-16 items-center transition-all duration-300",
        scrolled 
          ? "bg-background/80 backdrop-blur-lg shadow-sm" 
          : "bg-transparent"
      )}
    >
      <div className="container flex items-center justify-between">
        <div className="flex items-center">
          <Link 
            to="/" 
            className="mr-8 flex items-center gap-2 text-xl font-semibold tracking-tight"
          >
            <div className="rounded-md bg-primary p-1 text-primary-foreground">
              <Database className="h-5 w-5" />
            </div>
            <span>DataVision</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Button
                key={item.path + item.name}
                variant={location.pathname === item.path && item.name !== "Projects" ? "secondary" : "ghost"}
                size="sm"
                asChild
                className={cn(
                  "px-3",
                  location.pathname === item.path && item.name !== "Projects" && "bg-secondary/80"
                )}
              >
                <Link to={item.path} className="flex items-center">
                  {item.icon}
                  {item.name}
                </Link>
              </Button>
            ))}
          </nav>
        </div>
        
        <div className="flex items-center gap-2">
          {isProjectView && (
            <Button 
              variant="outline" 
              size="sm" 
              className="hidden sm:flex items-center"
              asChild
            >
              <Link to="/datasets/new">
                <FolderPlus className="w-4 h-4 mr-2" />
                New Dataset
              </Link>
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
