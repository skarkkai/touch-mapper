package org.osm2world.core.map_data.object_info;

public class Point {
    public final double x;
    public final double y;

    public Point(double var1, double var3) {
        this.x = var1;
        this.y = var3;
    }

    public int hashCode() {
        byte var2 = 1;
        long var3 = Double.doubleToLongBits(this.x);
        int var5 = 31 * var2 + (int)(var3 ^ var3 >>> 32);
        var3 = Double.doubleToLongBits(this.y);
        var5 = 31 * var5 + (int)(var3 ^ var3 >>> 32);
        return var5;
    }

    public boolean equals(Object var1) {
        if (this == var1) {
            return true;
        } else if (var1 == null) {
            return false;
        } else if (this.getClass() != var1.getClass()) {
            return false;
        } else {
            Point var2 = (Point)var1;
            if (Double.doubleToLongBits(this.x) != Double.doubleToLongBits(var2.x)) {
                return false;
            } else {
                return Double.doubleToLongBits(this.y) == Double.doubleToLongBits(var2.y);
            }
        }
    }
}
