
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings, Home, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

export function Navbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
    }
  ];

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex h-16 items-center transition-all duration-300",
        scrolled 
          ? "bg-background/80 backdrop-blur-lg shadow-sm border-b" 
          : "bg-transparent"
      )}
    >
      <div className="container flex items-center justify-between">
        <div className="flex items-center">
          <Link 
            to="/" 
            className="mr-8 flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <div className="flex items-center justify-center rounded-lg bg-primary w-8 h-8 text-primary-foreground">
              <FolderOpen className="h-5 w-5" />
            </div>
            <span>DataVision</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => (
              <Button
                key={item.path + item.name}
                variant={location.pathname === item.path ? "secondary" : "ghost"}
                size="sm"
                asChild
              >
                <Link 
                  to={item.path} 
                  className="flex items-center"
                >
                  {item.icon}
                  {item.name}
                </Link>
              </Button>
            ))}
          </nav>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Settings"
            asChild
            className="h-9 w-9"
          >
            <Link to="/api-settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
