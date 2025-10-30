import matplotlib.pyplot as plt
import matplotlib.patches as patches
from dataclasses import dataclass
from typing import List, Tuple
import math

@dataclass
class Furniture:
    """Represents a piece of furniture in the room"""
    name: str
    x: float
    y: float
    width: float
    height: float
    color: str = 'brown'
    linewidth: float = 1.5
    
    def get_center(self) -> Tuple[float, float]:
        """Get the center coordinates of the furniture"""
        return (self.x + self.width/2, self.y + self.height/2)

def draw_furniture(ax, furniture: Furniture):
    """Draw a single piece of furniture on the plot"""
    # Create rectangle
    rect = patches.Rectangle(
        (furniture.x, furniture.y), 
        furniture.width, 
        furniture.height,
        linewidth=furniture.linewidth, 
        edgecolor=furniture.color, 
        facecolor='none'
    )
    ax.add_patch(rect)
    
    # Add label
    center_x, center_y = furniture.get_center()
    ax.text(center_x, center_y, furniture.name, ha='center', va='center')

def draw_room_layout(ax, room_width: float, room_height: float, furniture_list: List[Furniture]):
    """Draw the complete room layout with all furniture"""
    # Draw room outline
    room = patches.Rectangle((0, 0), room_width, room_height, 
                            linewidth=2, edgecolor='black', facecolor='none')
    ax.add_patch(room)
    
    # Draw all furniture
    for furniture in furniture_list:
        draw_furniture(ax, furniture)

# --- Room configuration ---
room_width = 2.5
room_height = 4

# --- Furniture configuration ---
# Define furniture dimensions
Stove_width = 0.55
Stove_height = 0.85
Fridge_width = 0.65
Fridge_height = 0.65
Sink_width = 0.6
Sink_height = 1.2

# Create furniture objects
Stove = Furniture("Stove", room_width-2.5, 0.5, Stove_width, Stove_height, 'black')
Fridge = Furniture("Fridge", room_width-0.6, room_height-0.6, Fridge_width, Fridge_height, 'black')
Sink = Furniture("Sink", room_width-0.6, 0.0, Sink_width, Sink_height, 'black')

furniture_list = [
    Stove, Fridge, Sink
]

# --- Create the plot ---
fig, ax = plt.subplots(figsize=(10, 8))

# Draw the room layout
draw_room_layout(ax, room_width, room_height, furniture_list)



def add_dimension_lines(ax, room_width: float, room_height: float):
    """Add dimension lines to the room layout"""
    # --- Dimension lines (Horizontal) ---
    ax.annotate("", xy=(0, -0.3), xytext=(room_width, -0.3), 
                arrowprops=dict(arrowstyle='<->'))
    ax.plot([0, 0], [0, -0.3], color="black")
    ax.plot([room_width, room_width], [0, -0.3], color="black")
    ax.text(room_width/2, -0.5, f"{room_width} m", ha="center", va="top")

    # --- Dimension lines (Vertical) ---
    ax.annotate("", xy=(-0.3, 0), xytext=(-0.3, room_height), 
                arrowprops=dict(arrowstyle='<->'))
    ax.plot([-0.3, 0], [0, 0], color="black")
    ax.plot([-0.3, 0], [room_height, room_height], color="black")
    ax.text(-0.5, room_height/2, f"{room_height} m", ha="center", va="center", rotation=90)

def draw_dimension_line(ax, start_point, end_point, dimension_text, offset=0.2, text_offset=0.1):
    """Draw a proper dimension line with extension lines, arrows and dimension text"""
    x1, y1 = start_point
    x2, y2 = end_point
    
    # Calculate perpendicular direction for offset
    dx = x2 - x1
    dy = y2 - y1
    length = math.sqrt(dx**2 + dy**2)
    
    if length > 0:
        # Perpendicular direction (rotated 90 degrees)
        perp_x = -dy / length * offset
        perp_y = dx / length * offset
        
        # Extension lines (from object to dimension line)
        ext1_x = x1 + perp_x
        ext1_y = y1 + perp_y
        ext2_x = x2 + perp_x
        ext2_y = y2 + perp_y
        
        # Draw extension lines
        ax.plot([x1, ext1_x], [y1, ext1_y], 'b-', linewidth=0.8)
        ax.plot([x2, ext2_x], [y2, ext2_y], 'b-', linewidth=0.8)
        
        # Draw dimension line with arrows
        ax.annotate("", xy=(ext2_x, ext2_y), xytext=(ext1_x, ext1_y),
                   arrowprops=dict(arrowstyle='<->', color='blue', lw=1.2))
        
        # Add dimension text
        text_x = (ext1_x + ext2_x) / 2 + perp_x * text_offset
        text_y = (ext1_y + ext2_y) / 2 + perp_y * text_offset
        
        ax.text(text_x, text_y, dimension_text, 
                ha="center", va="center", fontsize=10, color='darkblue', fontweight='bold')

def add_furniture_annotations(ax, furniture_list: List[Furniture]):
    """Add proper technical dimensioning for furniture items"""
    for i, furniture in enumerate(furniture_list):
        # Calculate offsets for hierarchical dimensioning
        # Smaller dimensions closer to object, larger dimensions further away
        base_offset = 0.1
        width_offset = base_offset   # Hierarchical spacing
        height_offset = base_offset
        
        # Width dimension (horizontal) - always on top
        start_point = (furniture.x, furniture.y + furniture.height)
        end_point = (furniture.x + furniture.width, furniture.y + furniture.height)
        draw_dimension_line(ax, start_point, end_point, f"{furniture.width}m", 
                          offset=width_offset, text_offset=0.8)
        
        # Height dimension (vertical) - position based on furniture type
        if furniture.name == "Stove":
            # Stove: height dimension on the left side
            start_point = (furniture.x, furniture.y)
            end_point = (furniture.x, furniture.y + furniture.height)
            draw_dimension_line(ax, start_point, end_point, f"{furniture.height}m", text_offset=1.5)
        else:
            # Fridge and Sink: height dimension on the right side
            start_point = (furniture.x + furniture.width+0.2, furniture.y)
            end_point = (furniture.x + furniture.width+0.2, furniture.y + furniture.height)
            draw_dimension_line(ax, start_point, end_point, f"{furniture.height}m", 
                              offset=height_offset, text_offset=-2.8)

def calculate_triangle_properties(points):
    """Calculate triangle side lengths and area"""
    if len(points) != 3:
        return None, None, None
    
    p1, p2, p3 = points
    
    # Calculate side lengths
    side1 = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
    side2 = math.sqrt((p3[0] - p2[0])**2 + (p3[1] - p2[1])**2)
    side3 = math.sqrt((p1[0] - p3[0])**2 + (p1[1] - p3[1])**2)
    
    # Calculate area using Heron's formula
    s = (side1 + side2 + side3) / 2
    area = math.sqrt(s * (s - side1) * (s - side2) * (s - side3))
    
    return [side1, side2, side3], area

def draw_connecting_triangle(ax, furniture_list: List[Furniture]):
    """Draw a triangle connecting points in front of the furniture items"""
    if len(furniture_list) >= 3:
        # Get points in front of each furniture item
        front_points = []
        for i, furniture in enumerate(furniture_list[:3]):
            center_x, center_y = furniture.get_center()
            # Position point in front of the furniture
            if i == 0:  # Stove - point to the right
                front_x = furniture.x + furniture.width
                front_y = center_y
            elif i == 1:  # Fridge - point to the left  
                front_x = furniture.x
                front_y = center_y
            else:  # Sink - point to the left
                front_x = furniture.x
                front_y = center_y
            front_points.append((front_x, front_y))
        
        # Calculate triangle properties
        side_lengths, area = calculate_triangle_properties(front_points)
        
        # Create triangle connecting the front points
        triangle = patches.Polygon(
            front_points,
            linewidth=2,
            edgecolor='red',
            facecolor='none',
            linestyle='--'
        )
        ax.add_patch(triangle)
        
        # Add triangle measurements
        if side_lengths and area:
            # Display side lengths outside each edge
            for i, (p1, p2) in enumerate([(front_points[0], front_points[1]), 
                                        (front_points[1], front_points[2]), 
                                        (front_points[2], front_points[0])]):
                # Calculate midpoint of each edge
                mid_x = (p1[0] + p2[0]) / 2
                mid_y = (p1[1] + p2[1]) / 2
                
                # Calculate perpendicular direction to move label outside
                dx = p2[0] - p1[0]
                dy = p2[1] - p1[1]
                length = math.sqrt(dx**2 + dy**2)
                
                # Normalize and rotate 90 degrees to get perpendicular direction
                perp_x = -dy / length * 0.3  # 0.3 is the offset distance
                perp_y = dx / length * 0.3
                
                # Position label outside the edge
                label_x = mid_x + perp_x
                label_y = mid_y + perp_y
                
                # Add side length label outside the edge
                ax.text(label_x, label_y, f"{side_lengths[i]:.2f}m",
                       ha="center", va="center", fontsize=10,
                       color='darkblue', fontweight='bold')
            
            # Draw heights (altitudes) of the triangle - only draw one height to avoid clutter
            # Draw height from first vertex to opposite side
            vertex = front_points[0]
            side_p1, side_p2 = front_points[1], front_points[2]
            
            # Calculate foot of perpendicular from vertex to opposite side
            A = side_p2[1] - side_p1[1]
            B = side_p1[0] - side_p2[0]
            C = side_p2[0] * side_p1[1] - side_p1[0] * side_p2[1]
            
            # Distance from point to line
            denom = math.sqrt(A**2 + B**2)
            if denom > 0:
                t = -(A * vertex[0] + B * vertex[1] + C) / (A**2 + B**2)
                foot_x = vertex[0] + A * t
                foot_y = vertex[1] + B * t
                
                # Always draw height line (remove strict boundary check)
                # Draw height line
                ax.plot([vertex[0], foot_x], [vertex[1], foot_y], 
                       'r--', linewidth=1, alpha=0.7)
                
                # Calculate height length
                height_length = math.sqrt((vertex[0] - foot_x)**2 + (vertex[1] - foot_y)**2)
                
                # Add height label
                height_mid_x = (vertex[0] + foot_x) / 2
                height_mid_y = (vertex[1] + foot_y) / 2
                ax.text(height_mid_x, height_mid_y+0.15, f"h={height_length:.2f}m",
                       ha="center", va="center", fontsize=10,
                       color='darkblue', fontweight='bold')
            
            # Display area in the center of the triangle
            center_x = sum(point[0] for point in front_points) / 3
            center_y = sum(point[1] for point in front_points) / 3
            
            ax.text(center_x, center_y, f"Area:\n{area:.2f}m²",
                   ha="center", va="center", fontsize=10,
                   color='darkblue', fontweight='bold')

# Add dimension lines and annotations
add_dimension_lines(ax, room_width, room_height)
add_furniture_annotations(ax, furniture_list)

# Draw connecting triangle
draw_connecting_triangle(ax, furniture_list)

# Add student information
ax.text(-0.5, -0.8, "Sota Akasaka", 
        ha="left", va="center", fontsize=12, fontweight='normal')
ax.text(-0.5, -1.0, "2025280183", 
        ha="left", va="center", fontsize=12, fontweight='normal')

# --- Display settings ---
ax.set_xlim(-1, 3.5)
ax.set_ylim(-1.2, 5)
ax.set_aspect('equal')
ax.set_title("Room Layout", fontsize=14, fontweight='bold')

plt.savefig('room_layout.png', dpi=300, bbox_inches='tight')
print("Room layout saved as 'room_layout.png'")
